import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ThemeService } from '@theia/core/lib/browser/theming';
import type { Disposable } from '@theia/core/lib/common';
import type { WebviewTag } from 'electron';
import { AkariPartnerServer, PartnerAgentId, PartnerWebLaunch } from '../common/akari-partner-protocol';
import { PARTNER_AGENT_LABELS, PARTNER_CLI_ICON_CLASSES } from './partner-catalog';
import { resolvePartnerWebTheme } from '../common/partner-web-theme';
import '../electron-common/electron-api';

@injectable()
export class PartnerWebWidget extends ReactWidget {
    static readonly ID = 'akari-partner-web';
    @inject(AkariPartnerServer) protected readonly server!: AkariPartnerServer;
    @inject(ThemeService) protected readonly themeService!: ThemeService;
    private launch?: PartnerWebLaunch;
    private ownerId?: string;
    private host?: HTMLElement;
    private webview?: WebviewTag;
    private loaded = false;
    private slowLoading = false;
    private retryLoading?: () => void;
    private cancelLoading?: (error: Error) => void;
    private closePromise?: Promise<void>;
    private readonly themeListeners: Disposable[] = [];

    @postConstruct()
    protected init(): void {
        this.id = PartnerWebWidget.ID;
        this.title.label = 'チャット（DeepSeek）';
        this.title.caption = PARTNER_AGENT_LABELS.deepseek;
        this.title.iconClass = PARTNER_CLI_ICON_CLASSES.deepseek;
        this.title.closable = true;
        this.node.style.height = '100%';
        this.disposed.connect(() => {
            for (const listener of this.themeListeners) {
                try { listener.dispose(); } catch { /* Theme cleanup must not block widget disposal. */ }
            }
            this.themeListeners.length = 0;
            this.cancelLoading?.(new Error('DeepSeek Harness の作業画面が閉じられました'));
            this.removeWebview();
            void this.closeLaunch();
        });
        this.update();
    }

    isRunning(): boolean { return !!this.launch && this.launch.pid > 0 && !this.isDisposed; }
    get pid(): number | undefined { return this.launch?.pid; }
    get hasLaunch(): boolean { return !!this.launch; }
    get launchCwd(): string | undefined { return this.launch?.cwd; }

    async open(agent: PartnerAgentId, launch: PartnerWebLaunch, ownerId: string): Promise<void> {
        this.title.label = agent === 'deepseek' ? 'チャット（DeepSeek）' : `チャット（${PARTNER_AGENT_LABELS[agent]}）`;
        this.title.caption = PARTNER_AGENT_LABELS[agent];
        this.title.iconClass = PARTNER_CLI_ICON_CLASSES[agent];
        this.launch = launch;
        this.ownerId = ownerId;
        this.loaded = false;
        this.update();
        try {
            this.watchTheme();
            this.sendTheme();
            for (;;) {
                if (this.slowLoading) {
                    this.slowLoading = false;
                    this.update();
                }
                const slowTimer = setTimeout(() => {
                    this.slowLoading = true;
                    this.update();
                }, 20_000);
                const retry = new Promise<'retry'>(resolve => {
                    this.retryLoading = () => {
                        this.retryLoading = undefined;
                        resolve('retry');
                    };
                });
                const cancelled = new Promise<never>((_resolve, reject) => { this.cancelLoading = reject; });
                let outcome: 'retry' | 'loaded';
                try {
                    outcome = await Promise.race([
                        this.createWebview(launch.url).then(() => 'loaded' as const),
                        retry, cancelled
                    ]);
                } finally {
                    clearTimeout(slowTimer);
                    this.retryLoading = undefined;
                    this.cancelLoading = undefined;
                }
                if (outcome === 'retry') {
                    this.removeWebview();
                    if (this.isDisposed) throw new Error('DeepSeek Harness の作業画面が閉じられました');
                    continue;
                }
                if (this.isDisposed) throw new Error('DeepSeek Harness の作業画面が閉じられました');
                this.loaded = true;
                this.slowLoading = false;
                this.update();
                return;
            }
        } catch (error) {
            this.dispose();
            await this.closeLaunch();
            throw error;
        }
    }

    private watchTheme(): void {
        if (this.themeListeners.length) return;
        try {
            const registration = this.themeService.onDidColorThemeChange(() => this.sendTheme());
            void Promise.resolve(registration).then(listener => {
                if (this.isDisposed) {
                    try { listener.dispose(); } catch { /* Already closed. */ }
                } else {
                    this.themeListeners.push(listener);
                }
            }).catch(() => undefined);
        } catch { /* Theme observation must not block the webview. */ }
    }

    private sendTheme(): void {
        if (!this.ownerId || this.isDisposed) return;
        try {
            const theme = resolvePartnerWebTheme(this.themeService.getCurrentTheme().type);
            void Promise.resolve(window.electronAkariPartner.web.setTheme(this.ownerId, theme))
                .catch(() => undefined);
        } catch { /* Theme lookup or IPC must not block the webview. */ }
    }

    private closeLaunch(): Promise<void> {
        if (this.closePromise) return this.closePromise;
        const pid = this.launch?.pid;
        const ownerId = this.ownerId;
        this.launch = undefined;
        this.ownerId = undefined;
        this.closePromise = (async () => {
            if (pid && ownerId) await this.server.stopWebPartner(pid, ownerId).catch(() => undefined);
        })();
        return this.closePromise;
    }

    private createWebview(url: string): Promise<void> {
        const webview = document.createElement('webview') as WebviewTag;
        webview.setAttribute('src', url);
        webview.setAttribute('partition', 'persist:akari-partner-deepseek');
        webview.setAttribute('webpreferences', 'contextIsolation=yes, sandbox=yes, nodeIntegration=no, backgroundThrottling=no');
        webview.style.width = '100%';
        webview.style.height = '100%';
        webview.style.display = 'flex';
        const loading = new Promise<void>((resolve, reject) => {
            webview.addEventListener('did-finish-load', () => resolve());
            webview.addEventListener('did-fail-load', event => {
                if (event.isMainFrame && event.errorCode !== -3) reject(new Error(event.errorDescription));
            });
            webview.addEventListener('render-process-gone', () => reject(new Error('DeepSeek Harness の画面が停止しました')));
        });
        this.webview = webview;
        this.host?.appendChild(webview);
        return loading;
    }

    private removeWebview(): void {
        this.webview?.remove();
        this.webview = undefined;
    }

    protected override render(): React.ReactNode {
        return <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ flex: '0 0 auto', padding: '5px 10px', borderBottom: '1px solid var(--theia-panel-border)',
                fontSize: 11 }}>
                <div>{this.launch?.providerNote}</div>
                {this.launch?.guidance && <div>{this.launch.guidance}</div>}
                {this.launch && !this.loaded && <>
                    <div>DeepSeek Harness を読み込んでいます…</div>
                    {this.slowLoading && <div>
                        時間がかかっています。このウィンドウを前面に出すと読み込みが進みます。
                        <button onClick={() => this.retryLoading?.()}>再試行</button>
                    </div>}
                </>}
            </div>
            <div ref={node => {
                this.host = node ?? undefined;
                if (node && this.webview && this.webview.parentElement !== node) node.appendChild(this.webview);
            }}
                style={{ flex: '1 1 auto', minHeight: 0, background: 'var(--theia-editor-background)' }} />
        </div>;
    }
}
